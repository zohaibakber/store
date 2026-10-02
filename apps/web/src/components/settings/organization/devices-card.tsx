import { AlertCircleIcon, Delete02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { OrganizationMember } from "@store/auth";
import type { OrganizationDevice } from "@store/contracts";
import { formatDistanceToNowStrict } from "date-fns";

import { LoadingSpinner } from "@/components/app/loading-spinner";
import { FrameCard } from "@/components/shared/frame-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";
import { useOrganizationDevices } from "@/lib/devices";
import { formatCount } from "@/lib/format";

type DeviceActions = ReturnType<typeof useOrganizationDevices>["command"];

const UNNAMED_DEVICE = "Unnamed device";

const deviceName = (device: OrganizationDevice) => device.label ?? UNNAMED_DEVICE;

const lastSeen = (device: OrganizationDevice) =>
  `Seen ${formatDistanceToNowStrict(device.lastSeenAt, { addSuffix: true })}`;

function DeviceStanding({ device }: { device: OrganizationDevice }) {
  if (device.upToDate) return null;
  if (device.holdsBack) return <Badge variant="warning">Holding back orders</Badge>;
  return <Badge variant="outline">{device.ignored ? "Ignored" : "Needs update"}</Badge>;
}

function IgnoreDeviceDialog({
  command,
  device,
}: {
  command: DeviceActions;
  device: OrganizationDevice;
}) {
  const name = deviceName(device);

  const ignore = async () => {
    const done = await command({ _tag: "IgnoreDevice", replicaId: device.replicaId });
    if (done) toastManager.add({ title: `${name} ignored`, type: "success" });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button size="sm" variant="outline" />}>
        Ignore
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ignore {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Suppliers and purchase orders will work on your other devices. This device stops syncing
            once they are used, until Tabaaq is updated on it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <AlertDialogClose render={<Button />} onClick={() => void ignore()}>
            Ignore
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RemoveDeviceDialog({
  command,
  device,
}: {
  command: DeviceActions;
  device: OrganizationDevice;
}) {
  const name = deviceName(device);

  const remove = async () => {
    const done = await command({ _tag: "RemoveDevice", replicaId: device.replicaId });
    if (done) toastManager.add({ title: `${name} removed`, type: "success" });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button aria-label={`Remove ${name}`} size="icon-sm" variant="ghost" />}
      >
        <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            For a device you no longer use. It leaves this list and no longer holds anything back.
            If it syncs again, it comes back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" />} onClick={() => void remove()}>
            Remove
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeviceRow({
  command,
  device,
  isThisDevice,
  memberName,
}: {
  command: DeviceActions;
  device: OrganizationDevice;
  isThisDevice: boolean;
  memberName: string | undefined;
}) {
  const heed = async () => {
    await command({ _tag: "HeedDevice", replicaId: device.replicaId });
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate font-medium">{deviceName(device)}</span>
          {isThisDevice ? <Badge variant="secondary">This device</Badge> : null}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {memberName === undefined ? lastSeen(device) : `${memberName} · ${lastSeen(device)}`}
        </p>
      </div>
      <DeviceStanding device={device} />
      {device.upToDate || isThisDevice ? null : device.ignored ? (
        <Button onClick={() => void heed()} size="sm" variant="outline">
          Stop ignoring
        </Button>
      ) : (
        <IgnoreDeviceDialog command={command} device={device} />
      )}
      {isThisDevice ? (
        <span aria-hidden="true" className="size-8 shrink-0 sm:size-7" />
      ) : (
        <RemoveDeviceDialog command={command} device={device} />
      )}
    </div>
  );
}

function HeldBackNotice({ devices }: { devices: ReadonlyArray<OrganizationDevice> }) {
  const holding = devices.filter((device) => device.holdsBack);
  if (holding.length === 0) return null;
  const [first] = holding;
  const subject =
    holding.length === 1 && first !== undefined
      ? deviceName(first)
      : formatCount(holding.length, "device");

  return (
    <div className="p-4">
      <Alert variant="warning">
        <HugeiconsIcon aria-hidden="true" icon={AlertCircleIcon} />
        <AlertTitle>Suppliers and purchase orders are paused</AlertTitle>
        <AlertDescription>
          {subject} still {holding.length === 1 ? "runs" : "run"} an older Tabaaq. Update it, or
          ignore or remove it here.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function OrganizationDevicesCard({
  members,
}: {
  members: ReadonlyArray<OrganizationMember>;
}) {
  const { devices, error, thisDeviceId, reload, command } = useOrganizationDevices();
  const memberNames = new Map(members.map((member) => [String(member.userId), member.name]));

  return (
    <FrameCard
      action={
        <Button aria-label="Refresh devices" onClick={reload} size="icon-sm" variant="ghost">
          <HugeiconsIcon aria-hidden="true" icon={RefreshIcon} />
        </Button>
      }
      description={devices ? formatCount(devices.length, "device") : undefined}
      flush
      title="Devices"
    >
      {error ? (
        <div className="p-4">
          <Alert variant="error">
            <HugeiconsIcon aria-hidden="true" icon={AlertCircleIcon} />
            <AlertTitle>Could not load the devices</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : devices ? (
        <div className="flex flex-col divide-y">
          <HeldBackNotice devices={devices} />
          {devices.map((device) => (
            <DeviceRow
              command={command}
              device={device}
              isThisDevice={device.replicaId === thisDeviceId}
              key={device.replicaId}
              memberName={memberNames.get(device.userId)}
            />
          ))}
        </div>
      ) : (
        <LoadingSpinner className="h-24" label="Loading devices" />
      )}
    </FrameCard>
  );
}
