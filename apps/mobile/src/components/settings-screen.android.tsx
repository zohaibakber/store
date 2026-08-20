import { Host } from "@expo/ui";
import {
  Column,
  LazyColumn,
  ListItem,
  Surface,
  Text,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import * as ComposeModifiers from "@expo/ui/jetpack-compose/modifiers";
import { clickable, clip, fillMaxSize, fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import Constants from "expo-constants";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import buildIcon from "@/assets/icons/build.xml";
import infoIcon from "@/assets/icons/info.xml";
import logoutIcon from "@/assets/icons/logout.xml";
import personIcon from "@/assets/icons/person.xml";
import refreshIcon from "@/assets/icons/refresh.xml";
import { TintedIcon } from "@/components/material-list.android";
import {
  productStatusView,
  useProductActions,
  useProductData,
  useProductStatus,
} from "@/features/products/products-provider";
import { mobileApplicationId } from "@/lib/auth-client";
import { useMobileAuth } from "@/lib/auth-provider";
import { useAppColorScheme } from "@/theme/appearance";

const composeClip = ComposeModifiers["Shapes"];
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

type ItemPosition = "only" | "leading" | "middle" | "trailing";

function itemPosition(index: number, total: number): ItemPosition {
  if (total <= 1) return "only";
  if (index === 0) return "leading";
  if (index === total - 1) return "trailing";
  return "middle";
}

/** Pixel Settings: extra-large on the group ends, 4dp between rows, 2dp gap. */
function itemCornerRadii(position: ItemPosition) {
  const full = 24;
  const small = 4;
  switch (position) {
    case "leading":
      return { topStart: full, topEnd: full, bottomStart: small, bottomEnd: small };
    case "trailing":
      return { topStart: small, topEnd: small, bottomStart: full, bottomEnd: full };
    case "middle":
      return { topStart: small, topEnd: small, bottomStart: small, bottomEnd: small };
    case "only":
      return { topStart: full, topEnd: full, bottomStart: full, bottomEnd: full };
    default: {
      const _exhaustive: never = position;
      return _exhaustive;
    }
  }
}

function SettingsSection({ headline, children }: { headline: string; children: ReactNode }) {
  const colors = useMaterialColors();
  const rows = Children.toArray(children).filter(
    (child): child is ReactElement<{ position?: ItemPosition }> => isValidElement(child),
  );

  return (
    <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 4 }}>
      <Text color={colors.onSurfaceVariant} style={{ typography: "titleSmall" }}>
        {headline}
      </Text>
      <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 2 }}>
        {rows.map((child, index) =>
          cloneElement(child, { position: itemPosition(index, rows.length) }),
        )}
      </Column>
    </Column>
  );
}

function SettingsListItem({
  headline,
  supporting,
  trailing,
  leading,
  onClick,
  position = "only",
  destructive = false,
}: {
  headline: string;
  supporting?: string;
  trailing?: string;
  leading: ReactNode;
  onClick?: () => void;
  position?: ItemPosition;
  destructive?: boolean;
}) {
  const colors = useMaterialColors();
  const headlineColor = destructive ? colors.error : colors.onSurface;

  return (
    <ListItem
      colors={{
        containerColor: colors.surfaceContainerLowest,
        contentColor: headlineColor,
        leadingContentColor: colors.onSurface,
        supportingContentColor: colors.onSurfaceVariant,
        trailingContentColor: colors.onSurfaceVariant,
      }}
      modifiers={[
        fillMaxWidth(),
        clip(composeClip.RoundedCorner(itemCornerRadii(position))),
        ...(onClick ? [clickable(onClick)] : []),
      ]}
      shadowElevation={0}
      tonalElevation={0}
    >
      <ListItem.HeadlineContent>
        <Text color={headlineColor}>{headline}</Text>
      </ListItem.HeadlineContent>
      {supporting ? (
        <ListItem.SupportingContent>
          <Text color={colors.onSurfaceVariant}>{supporting}</Text>
        </ListItem.SupportingContent>
      ) : null}
      <ListItem.LeadingContent>{leading}</ListItem.LeadingContent>
      {trailing ? (
        <ListItem.TrailingContent>
          <Text color={colors.onSurfaceVariant}>{trailing}</Text>
        </ListItem.TrailingContent>
      ) : null}
    </ListItem>
  );
}

export function SettingsScreen() {
  const colorScheme = useAppColorScheme();
  const colors = useMaterialColors({ colorScheme });
  const insets = useSafeAreaInsets();
  const {
    state,
    actions: { signOut },
  } = useMobileAuth();
  const { products } = useProductData();
  const { refreshing, error, lastUpdatedAt } = productStatusView(useProductStatus());
  const { refresh } = useProductActions();
  const userName = state._tag === "Authenticated" ? state.workspace.user.name : "Signed out";
  const userEmail = state._tag === "Authenticated" ? state.workspace.user.email : undefined;
  const version = Constants.expoConfig?.version ?? "0.1.0";
  const syncDetail = lastUpdatedAt
    ? `${products.length} products synced at ${timeFormatter.format(lastUpdatedAt)}`
    : "Inventory has not synced yet.";

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "Tabaaq needs an account, so this returns you to sign-in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void signOut();
        },
      },
    ]);
  };

  return (
    <Host colorScheme={colorScheme} key={colorScheme} style={{ flex: 1 }}>
      <Surface color={colors.surfaceContainer} modifiers={[fillMaxSize()]}>
        <LazyColumn
          contentPadding={{ bottom: 120, end: 16, start: 16, top: insets.top + 8 }}
          modifiers={[fillMaxSize()]}
          verticalArrangement={{ spacedBy: 16 }}
        >
          <SettingsSection headline="Account">
            <SettingsListItem
              headline={userName}
              leading={
                <TintedIcon
                  container={colors.primaryContainer}
                  source={personIcon}
                  tint={colors.onPrimaryContainer}
                />
              }
              supporting={userEmail}
            />
          </SettingsSection>

          <SettingsSection headline="Inventory sync">
            <SettingsListItem
              headline="Sync status"
              leading={
                <TintedIcon
                  container={error ? colors.errorContainer : colors.secondaryContainer}
                  source={refreshIcon}
                  tint={error ? colors.onErrorContainer : colors.onSecondaryContainer}
                />
              }
              supporting={`${error ? "Needs attention" : "Up to date"} · ${syncDetail}`}
            />
            <SettingsListItem
              headline={refreshing ? "Syncing…" : "Sync now"}
              leading={
                <TintedIcon
                  container={colors.tertiaryContainer}
                  source={refreshIcon}
                  tint={colors.onTertiaryContainer}
                />
              }
              onClick={() => void refresh()}
              supporting="Refresh local inventory now"
            />
          </SettingsSection>

          <SettingsSection headline="About">
            <SettingsListItem
              headline="App version"
              leading={
                <TintedIcon
                  container={colors.primaryContainer}
                  source={infoIcon}
                  tint={colors.onPrimaryContainer}
                />
              }
              trailing={version}
            />
            <SettingsListItem
              headline={__DEV__ ? "Development build" : "Production build"}
              leading={
                <TintedIcon
                  container={colors.secondaryContainer}
                  source={buildIcon}
                  tint={colors.onSecondaryContainer}
                />
              }
              supporting={mobileApplicationId}
            />
            {state._tag === "Authenticated" ? (
              <SettingsListItem
                destructive
                headline="Sign out"
                leading={
                  <TintedIcon
                    container={colors.errorContainer}
                    source={logoutIcon}
                    tint={colors.onErrorContainer}
                  />
                }
                onClick={confirmSignOut}
              />
            ) : null}
          </SettingsSection>

          <Text color={colors.onSurfaceVariant} style={{ typography: "bodySmall" }}>
            Tabaaq keeps your inventory available offline and syncs changes when connected.
          </Text>
        </LazyColumn>
      </Surface>
    </Host>
  );
}

export default SettingsScreen;
