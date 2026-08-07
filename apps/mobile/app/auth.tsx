import { router } from "expo-router";
import { Alert as HeroAlert } from "heroui-native/alert";
import { Button } from "heroui-native/button";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { LinkButton } from "heroui-native/link-button";
import { TextField } from "heroui-native/text-field";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";

import { Brand } from "@/components/brand";
import { authClient, authErrorMessage } from "@/lib/auth-client";

type AuthMode = "sign-in" | "sign-up";

const slugOf = (name: string) =>
  name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || `store-${Date.now()}`;

export default function AuthScreen() {
  const session = authClient.useSession();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef({ name: "", email: "", password: "" });
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { name, email, password } = form.current;
      if (!email.trim() || password.length < 8 || (mode === "sign-up" && !name.trim())) {
        throw new Error("Enter your details and use a password with at least 8 characters.");
      }

      if (mode === "sign-in") {
        const result = await authClient.signIn.email(
          { email: email.trim(), password },
          { disableSignal: true },
        );
        if (result.error) throw result.error;
      } else {
        const result = await authClient.signUp.email(
          {
            name: name.trim(),
            email: email.trim(),
            password,
          },
          { disableSignal: true },
        );
        if (result.error) throw result.error;
        const organization = await authClient.organization.create({
          name: `${name.trim()}'s Store`,
          slug: slugOf(name),
        });
        if (organization.error) throw organization.error;
        if (organization.data) {
          const selected = await authClient.organization.setActive({
            organizationId: organization.data.id,
          });
          if (selected.error) throw selected.error;
        }
      }

      await session.refetch();
      if (!authClient.$store.atoms.session.get().data?.user) {
        throw new Error("Your account was signed in, but the session could not be restored.");
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
    form.current = { name: "", email: "", password: "" };
  };

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
              {mode === "sign-in" ? "Welcome back" : "Set up your store"}
            </Text>
            <Text className="text-sm leading-5 font-normal text-muted">
              {mode === "sign-in"
                ? "Sign in to manage your inventory on the go."
                : "Create your account and start your inventory."}
            </Text>
          </View>

          <View key={mode} className="gap-4">
            {mode === "sign-up" ? (
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
              {pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}
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
