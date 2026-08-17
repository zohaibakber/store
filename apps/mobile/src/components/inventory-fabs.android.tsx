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
import { useAppColorScheme } from "@/theme/appearance";

export function InventoryFabs() {
  const colorScheme = useAppColorScheme();

  return (
    <Host colorScheme={colorScheme} matchContents>
      <Column horizontalAlignment="end" verticalArrangement={{ spacedBy: 16 }}>
        <SmallFloatingActionButton onClick={() => router.push("/products/scan")}>
          <SmallFloatingActionButton.Icon>
            <Icon contentDescription="Scan product" source={cameraIcon} />
          </SmallFloatingActionButton.Icon>
        </SmallFloatingActionButton>
        <ExtendedFloatingActionButton onClick={() => router.push("/products/new")}>
          <ExtendedFloatingActionButton.Icon>
            <Icon contentDescription="New product" source={addIcon} />
          </ExtendedFloatingActionButton.Icon>
          <ExtendedFloatingActionButton.Text>
            <Text>New product</Text>
          </ExtendedFloatingActionButton.Text>
        </ExtendedFloatingActionButton>
      </Column>
    </Host>
  );
}
