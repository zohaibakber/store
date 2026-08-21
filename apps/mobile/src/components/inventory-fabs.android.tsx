import { Host } from "@expo/ui";
import {
  Column,
  ExtendedFloatingActionButton,
  Icon,
  SmallFloatingActionButton,
  Text,
} from "@expo/ui/jetpack-compose";
import { router } from "expo-router";

import addIcon from "@/assets/icons/add.xml";
import cameraIcon from "@/assets/icons/camera.xml";
import { useComposeTheme } from "@/theme/compose-colors";
import { typography } from "@/theme/typography";

/**
 * Android keeps Material's FABs — the ripple, the elevation and the extended
 * shape are the platform's, and they earn it — but the containers are
 * `card`/`primary` from our palette rather than Material You's primary
 * container. Same hierarchy as iOS: the quiet scan button, the filled create
 * button.
 */
export function InventoryFabs() {
  const { scheme, seedColor, tokens } = useComposeTheme();

  return (
    <Host colorScheme={scheme} key={scheme} matchContents seedColor={seedColor}>
      <Column horizontalAlignment="end" verticalArrangement={{ spacedBy: 12 }}>
        <SmallFloatingActionButton
          containerColor={tokens.card}
          onClick={() => router.push("/products/scan")}
        >
          <SmallFloatingActionButton.Icon>
            <Icon
              contentDescription="Scan a product label"
              source={cameraIcon}
              tint={tokens.foreground}
            />
          </SmallFloatingActionButton.Icon>
        </SmallFloatingActionButton>
        <ExtendedFloatingActionButton
          containerColor={tokens.primary}
          onClick={() => router.push("/products/new")}
        >
          <ExtendedFloatingActionButton.Icon>
            <Icon
              contentDescription="New product"
              source={addIcon}
              tint={tokens.primaryForeground}
            />
          </ExtendedFloatingActionButton.Icon>
          <ExtendedFloatingActionButton.Text>
            <Text
              color={tokens.primaryForeground}
              style={{
                fontFamily: typography.bodyMedium.fontFamily,
                fontSize: typography.bodyMedium.fontSize,
              }}
            >
              New product
            </Text>
          </ExtendedFloatingActionButton.Text>
        </ExtendedFloatingActionButton>
      </Column>
    </Host>
  );
}
