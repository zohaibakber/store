import { useNativeState } from "@expo/ui";
import { Store01Icon } from "@hugeicons/core-free-icons";
import * as React from "react";
import { View } from "react-native";

import { useAuthActions, useSession, type AuthProblem, type SessionOrganization } from "@/auth";
import { ActionButton } from "@/auth/ui/action-button";
import { AuthScreen, ProblemMessage, fieldError } from "@/auth/ui/auth-screen";
import { Field } from "@/auth/ui/field";
import { colors, radius, space } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";

const roleLabel = (role: string) => {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    default:
      return role;
  }
};

const canRename = (role: string) => role === "owner" || role === "admin";

function StoreCard({ organization }: { readonly organization: SessionOrganization }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space[3],
        padding: space[4],
        borderRadius: radius.lg,
        backgroundColor: colors.surface,
      }}
    >
      <Icon icon={Store01Icon} />
      <View style={{ flex: 1, gap: space[1] }}>
        <Text size="lg" weight="medium" numberOfLines={2}>
          {organization.name}
        </Text>
        <Text tone="muted">{roleLabel(organization.role)}</Text>
      </View>
    </View>
  );
}

type Busy = "continue" | "join" | "signOut" | null;

function OrganizationForm({
  email,
  organization,
  signOut,
}: {
  readonly email: string;
  readonly organization: SessionOrganization | null;
  readonly signOut: () => Promise<void>;
}) {
  const { confirmOrganization, joinOrganization } = useAuthActions();
  const nameState = useNativeState(organization?.name ?? "");
  const invitationState = useNativeState("");
  const [name, setName] = React.useState(organization?.name ?? "");
  const [invitation, setInvitation] = React.useState("");
  const [busy, setBusy] = React.useState<Busy>(null);
  const [problem, setProblem] = React.useState<AuthProblem | null>(null);
  const renamable = organization !== null && canRename(organization.role);

  const perform = async (lane: Exclude<Busy, null>, action: () => Promise<AuthProblem | null>) => {
    if (busy !== null) return;
    setBusy(lane);
    setProblem(null);
    const failure = await action();
    setBusy(null);
    setProblem(failure);
  };

  const proceed = () =>
    perform("continue", async () => {
      const result = await confirmOrganization(renamable ? { name } : {});
      return result._tag === "Failed" ? result.problem : null;
    });

  const join = (value: string) =>
    perform("join", async () => {
      const result = await joinOrganization(value);
      return result._tag === "Failed" ? result.problem : null;
    });

  const leave = () =>
    perform("signOut", async () => {
      await signOut();
      return null;
    });

  return (
    <AuthScreen
      title={organization === null ? "Join a store" : "Choose your store"}
      description={`Signed in as ${email}.`}
      footer={
        <ActionButton
          label="Sign out"
          variant="quiet"
          loading={busy === "signOut"}
          disabled={busy !== null && busy !== "signOut"}
          onPress={() => void leave()}
        />
      }
    >
      {organization === null ? null : (
        <View style={{ gap: space[4] }}>
          <StoreCard organization={organization} />
          {renamable ? (
            <Field
              label="Store name"
              state={nameState}
              onChangeText={(text) => {
                setName(text);
                setProblem(null);
              }}
              error={fieldError(problem, "organizationName")}
              hint="Customers and staff see this name."
              autoCapitalize="words"
              returnKeyType="done"
              editable={busy === null}
            />
          ) : null}
          <ActionButton
            label="Continue"
            loading={busy === "continue"}
            disabled={busy !== null && busy !== "continue"}
            onPress={() => void proceed()}
          />
        </View>
      )}
      <ProblemMessage problem={problem} />
      <View style={{ gap: space[4] }}>
        <View style={{ gap: space[1] }}>
          <Text size="base" weight="medium">
            {organization === null ? "Have an invitation?" : "Joining another store?"}
          </Text>
          <Text tone="muted">Paste the invitation code the store owner sent you.</Text>
        </View>
        <Field
          label="Invitation code"
          state={invitationState}
          onChangeText={(text) => {
            setInvitation(text);
            setProblem(null);
          }}
          error={fieldError(problem, "invitation")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={(text) => void join(text)}
          editable={busy === null}
        />
        <ActionButton
          label="Join store"
          variant={organization === null ? "primary" : "secondary"}
          loading={busy === "join"}
          disabled={(busy !== null && busy !== "join") || invitation.trim().length === 0}
          onPress={() => void join(invitation)}
        />
      </View>
    </AuthScreen>
  );
}

export default function OrganizationScreen() {
  const session = useSession();
  if (session.status !== "needsOrganization") return null;
  return (
    <OrganizationForm
      email={session.email}
      organization={session.organization}
      signOut={session.signOut}
    />
  );
}
