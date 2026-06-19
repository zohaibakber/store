import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Notification03Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons"

import { ModeToggle } from "@/components/mode-toggle"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Toaster } from "@/components/ui/sonner"

export const Route = createFileRoute("/")({ component: App })

function App() {
  const [count, setCount] = useState(0)
  const [notifications, setNotifications] = useState(true)

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              shadcn/ui showcase
            </h1>
            <p className="text-sm text-muted-foreground">
              All registry components are installed. Try the interactive demos
              below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">55 components</Badge>
            <ModeToggle />
          </div>
        </header>

        <Separator />

        <Tabs defaultValue="demo" className="gap-4">
          <TabsList>
            <TabsTrigger value="demo">Demo</TabsTrigger>
            <TabsTrigger value="form">Form</TabsTrigger>
          </TabsList>

          <TabsContent value="demo">
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Counter</CardTitle>
                  <CardDescription>
                    Click to increment local state.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tabular-nums">{count}</p>
                </CardContent>
                <CardFooter className="gap-2">
                  <Button onClick={() => setCount((c) => c + 1)}>
                    <HugeiconsIcon icon={SparklesIcon} data-icon="inline-start" />
                    Increment
                  </Button>
                  <Button variant="outline" onClick={() => setCount(0)}>
                    Reset
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Settings</CardTitle>
                  <CardDescription>Toggle and notify.</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="notifications">
                      Notifications
                    </FieldLabel>
                    <Switch
                      id="notifications"
                      checked={notifications}
                      onCheckedChange={setNotifications}
                    />
                  </Field>
                  <Badge variant={notifications ? "default" : "outline"}>
                    {notifications ? "Enabled" : "Disabled"}
                  </Badge>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      toast.success("Hello from shadcn/ui", {
                        description: notifications
                          ? "Notifications are enabled."
                          : "Notifications are disabled.",
                      })
                    }
                  >
                    <HugeiconsIcon
                      icon={Notification03Icon}
                      data-icon="inline-start"
                    />
                    Show toast
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="form">
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>
                  Edit your details in a dialog.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-3">
                <Avatar>
                  <AvatarFallback>SC</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">shadcn</span>
                  <span className="text-sm text-muted-foreground">
                    m@example.com
                  </span>
                </div>
              </CardContent>
              <CardFooter>
                <Dialog>
                  <DialogTrigger
                    render={<Button variant="outline">Edit profile</Button>}
                  />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Edit profile</DialogTitle>
                      <DialogDescription>
                        Update your name. This demo doesn&apos;t persist
                        changes.
                      </DialogDescription>
                    </DialogHeader>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="name">Name</FieldLabel>
                        <Input id="name" defaultValue="shadcn" />
                        <FieldDescription>
                          Shown on your profile.
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                    <DialogFooter>
                      <DialogClose
                        render={<Button variant="outline">Cancel</Button>}
                      />
                      <DialogClose
                        render={
                          <Button onClick={() => toast("Profile saved")}>
                            Save
                          </Button>
                        }
                      />
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <Toaster />
    </main>
  )
}
