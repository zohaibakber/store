import { useOrganizationList, useUser } from "@clerk/expo";
import { useSignIn, useSignUp } from "@clerk/expo/legacy";
import { Redirect, router } from "expo-router";
import { Alert as HeroAlert } from "heroui-native/alert";
import { Button } from "heroui-native/button";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { LinkButton } from "heroui-native/link-button";
import { TextField } from "heroui-native/text-field";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";

import { Brand } from "@/components/brand";
import { authErrorMessage } from "@/lib/auth-client";

type AuthMode = "sign-in" | "sign-up";

export default function AuthScreen() {
  const { user } = useUser();
  const { isLoaded: signInLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setActiveSignUp } = useSignUp();
  const { createOrganization, setActive: setActiveOrganization } = useOrganizationList();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const form = useRef({ name: "", email: "", password: "", code: "" });
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const ensureOrganization = async () => {
    if (!createOrganization || !setActiveOrganization) return;
    const created = await createOrganization({
      name: `${form.current.name.trim() || "My"}'s Store`,
    });
    await setActiveOrganization({ organization: created.id });
  };

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (!signInLoaded || !signUpLoaded || !signIn || !signUp) {
        throw new Error("Authentication is still loading.");
      }
      const { name, email, password, code } = form.current;
      if (needsVerification) {
        const verified = await signUp.attemptEmailAddressVerification({ code });
        if (verified.status !== "complete" || !verified.createdSessionId) {
          throw new Error("That verification code could not be used.");
        }
        await setActiveSignUp({ session: verified.createdSessionId });
        await ensureOrganization();
        router.replace("/home");
        return;
      }

      if (!email.trim() || password.length < 8 || (mode === "sign-up" && !name.trim())) {
        throw new Error("Enter your details and use a password with at least 8 characters.");
      }

      if (mode === "sign-in") {
        const result = await signIn.create({ identifier: email.trim(), password });
        if (result.status !== "complete" || !result.createdSessionId) {
          throw new Error("Additional verification is required to finish signing in.");
        }
        await setActiveSignIn({ session: result.createdSessionId });
      } else {
        const created = await signUp.create({
          emailAddress: email.trim(),
          password,
          firstName: name.trim(),
        });
        if (created.status === "complete" && created.createdSessionId) {
          await setActiveSignUp({ session: created.createdSessionId });
          await ensureOrganization();
        } else {
          await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
          setNeedsVerification(true);
          return;
        }
      }

      router.replace("/home");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const toggleMode = () => {
    setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
    setError(null);
    setNeedsVerification(false);
    form.current = { name: "", email: "", password: "", code: "" };
  };

  if (user) return <Redirect href="/home" />;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView
        className="bg-background"
        contentContainerClassName="flex-grow justify-center px-6 py-10"
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-sm gap-7 self-center">
          <Brand />
          <View className="gap-1.5">
            <Text className="text-2xl leading-8 font-medium text-foreground">
              {needsVerification
                ? "Check your email"
                : mode === "sign-in"
                  ? "Welcome back"
                  : "Set up your store"}
            </Text>
            <Text className="text-sm leading-5 font-normal text-muted">
              {needsVerification
                ? "Enter the verification code we sent you."
                : mode === "sign-in"
                  ? "Sign in to manage your inventory on the go."
                  : "Create your account and start your inventory."}
            </Text>
          </View>

          <View key={mode} className="gap-4">
            {mode === "sign-up" && !needsVerification ? (
              <TextField isRequired>
                <Label>Your name</Label>
                <Input
                  autoComplete="name"
                  onChangeText={(name) => (form.current.name = name)}
                  onSubmitEditing={() => emailRef.current?.focus()}
                  placeholder="Your name"
                  returnKeyType="next"
                />
              </TextField>
            ) : null}
            {!needsVerification ? (
              <>
                <TextField isRequired>
                  <Label>Email</Label>
                  <Input
                    ref={emailRef}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    onChangeText={(email) => (form.current.email = email)}
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    placeholder="m@example.com"
                    returnKeyType="next"
                  />
                </TextField>
                <TextField isRequired>
                  <Label>Password</Label>
                  <Input
                    ref={passwordRef}
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    onChangeText={(password) => (form.current.password = password)}
                    onSubmitEditing={() => void submit()}
                    placeholder="At least 8 characters"
                    returnKeyType="done"
                    secureTextEntry
                  />
                </TextField>
              </>
            ) : (
              <TextField isRequired>
                <Label>Verification code</Label>
                <Input
                  autoComplete="one-time-code"
                  keyboardType="number-pad"
                  onChangeText={(code) => (form.current.code = code)}
                  onSubmitEditing={() => void submit()}
                  placeholder="6-digit code"
                  returnKeyType="done"
                />
              </TextField>
            )}
          </View>

          {error ? (
            <HeroAlert status="danger">
              <HeroAlert.Indicator />
              <HeroAlert.Content>
                <HeroAlert.Title>Could not continue</HeroAlert.Title>
                <HeroAlert.Description>{error}</HeroAlert.Description>
              </HeroAlert.Content>
            </HeroAlert>
          ) : null}

          <View className="items-center gap-4">
            <Button className="w-full" isDisabled={pending} onPress={() => void submit()}>
              {pending
                ? "Please wait…"
                : needsVerification
                  ? "Verify email"
                  : mode === "sign-in"
                    ? "Sign in"
                    : "Create account"}
            </Button>
            <LinkButton isDisabled={pending} onPress={toggleMode}>
              <LinkButton.Label className="text-link">
                {mode === "sign-in"
                  ? "New to Tabaaq? Create account"
                  : "Already have an account? Sign in"}
              </LinkButton.Label>
            </LinkButton>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
