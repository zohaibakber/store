import {
  Box,
  Column,
  Icon,
  ListItem,
  SmallFloatingActionButton,
  Surface,
  Text,
  TextButton,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import * as ComposeModifiers from "@expo/ui/jetpack-compose/modifiers";
import {
  align,
  background,
  clickable,
  clip,
  fillMaxWidth,
  offset,
  padding,
  size,
  wrapContentHeight,
  wrapContentWidth,
} from "@expo/ui/jetpack-compose/modifiers";
import { router } from "expo-router";
import type { ReactNode } from "react";

import cameraIcon from "@/assets/icons/camera.xml";

const composeClip = ComposeModifiers["Shapes"];
const extraLargeClip = clip(composeClip.RoundedCorner(24));

export function TintedIcon({
  source,
  container,
  tint,
}: {
  source: number;
  container: string;
  tint: string;
}) {
  return (
    <Box
      contentAlignment="center"
      modifiers={[size(40, 40), clip(composeClip.Circle), background(container)]}
    >
      <Icon source={source} size={20} tint={tint} />
    </Box>
  );
}

export function ListSection({
  headline,
  supporting,
  children,
}: {
  headline?: string;
  supporting?: string;
  children?: ReactNode;
}) {
  const colors = useMaterialColors();
  return (
    <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 8 }}>
      {headline ? (
        <Text color={colors.onSurfaceVariant} style={{ typography: "titleSmall" }}>
          {headline}
        </Text>
      ) : null}
      {supporting ? (
        <Text color={colors.onSurfaceVariant} style={{ typography: "bodySmall" }}>
          {supporting}
        </Text>
      ) : null}
      {children}
    </Column>
  );
}

export function ErrorBanner({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  const colors = useMaterialColors();
  return (
    <Surface color={colors.errorContainer} modifiers={[fillMaxWidth(), extraLargeClip]}>
      <Column modifiers={[padding(16, 16, 16, 16)]} verticalArrangement={{ spacedBy: 8 }}>
        <Text color={colors.onErrorContainer} style={{ typography: "titleSmall" }}>
          {title}
        </Text>
        <Text color={colors.onErrorContainer}>{message}</Text>
        <TextButton onClick={onRetry}>
          <Text color={colors.onErrorContainer}>Retry</Text>
        </TextButton>
      </Column>
    </Surface>
  );
}

export function FilledListCard({ children }: { children: ReactNode }) {
  const colors = useMaterialColors();
  return (
    <Surface
      color={colors.surfaceContainerLowest}
      modifiers={[fillMaxWidth(), extraLargeClip, wrapContentHeight()]}
    >
      <Column modifiers={[fillMaxWidth(), wrapContentHeight(), padding(8, 8, 8, 8)]}>
        {children}
      </Column>
    </Surface>
  );
}

export function MaterialListItem({
  headline,
  supporting,
  overline,
  trailing,
  trailingColor,
  leading,
  onClick,
  flush = false,
  destructive = false,
}: {
  headline: string;
  supporting?: string;
  overline?: string;
  trailing?: string;
  trailingColor?: string;
  leading?: ReactNode;
  onClick?: () => void;
  flush?: boolean;
  destructive?: boolean;
}) {
  const colors = useMaterialColors();
  const headlineColor = destructive ? colors.error : colors.onSurface;
  const supportColor = colors.onSurfaceVariant;
  const trailColor = trailingColor ?? colors.onSurfaceVariant;
  const row = (
    <ListItem
      colors={{
        containerColor: "#00000000",
        contentColor: headlineColor,
        leadingContentColor: colors.onSurface,
        overlineContentColor: supportColor,
        supportingContentColor: supportColor,
        trailingContentColor: trailColor,
      }}
      modifiers={onClick ? [fillMaxWidth(), clickable(onClick)] : [fillMaxWidth()]}
      shadowElevation={0}
      tonalElevation={0}
    >
      <ListItem.HeadlineContent>
        <Text color={headlineColor}>{headline}</Text>
      </ListItem.HeadlineContent>
      {overline ? (
        <ListItem.OverlineContent>
          <Text color={supportColor}>{overline}</Text>
        </ListItem.OverlineContent>
      ) : null}
      {supporting ? (
        <ListItem.SupportingContent>
          <Text color={supportColor}>{supporting}</Text>
        </ListItem.SupportingContent>
      ) : null}
      {leading ? <ListItem.LeadingContent>{leading}</ListItem.LeadingContent> : null}
      {trailing ? (
        <ListItem.TrailingContent>
          <Text color={trailColor}>{trailing}</Text>
        </ListItem.TrailingContent>
      ) : null}
    </ListItem>
  );

  if (flush) {
    return row;
  }

  return (
    <Surface
      color={colors.surfaceContainerLowest}
      modifiers={[fillMaxWidth(), extraLargeClip, wrapContentHeight()]}
    >
      {row}
    </Surface>
  );
}

export function InventoryFabButtons() {
  return (
    <Column
      horizontalAlignment="end"
      modifiers={[
        align("bottomEnd"),
        wrapContentWidth("end"),
        wrapContentHeight("bottom"),
        offset(-16, -96),
      ]}
    >
      <SmallFloatingActionButton onClick={() => router.push("/products/scan")}>
        <SmallFloatingActionButton.Icon>
          <Icon contentDescription="Scan product" source={cameraIcon} />
        </SmallFloatingActionButton.Icon>
      </SmallFloatingActionButton>
    </Column>
  );
}
