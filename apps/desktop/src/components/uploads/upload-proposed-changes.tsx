import { CheckmarkCircle02Icon, FileAttachmentIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { useUpload } from "./upload-context";

function UploadProposedChanges() {
  const {
    state: { changes },
    actions: { applyChanges },
    meta: { processing },
  } = useUpload();

  if (changes.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Proposed changes{" "}
          <Badge className="ml-2" variant="secondary">
            {changes.length}
          </Badge>
        </CardTitle>
        <CardDescription>
          Nothing changes in your store until you apply this review.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ItemGroup>
          {changes.map((change, index) => (
            <Item key={`${change.name}-${index}`} variant="outline">
              <HugeiconsIcon
                icon={change.type === "create_product" ? FileAttachmentIcon : CheckmarkCircle02Icon}
              />
              <ItemContent>
                <ItemTitle>{change.name}</ItemTitle>
                <ItemDescription>
                  {change.type === "create_product"
                    ? "New product will be created"
                    : "Existing product inventory will be updated"}
                  {` · ${change.packQuantity} packs · ${change.unitQuantity} units`}
                  {change.batchNumber ? ` · Batch ${change.batchNumber}` : ""}
                </ItemDescription>
              </ItemContent>
              <Badge variant={change.type === "create_product" ? "default" : "secondary"}>
                {change.type === "create_product" ? "New product" : "Inventory update"}
              </Badge>
            </Item>
          ))}
        </ItemGroup>
        <Button disabled={processing} onClick={() => void applyChanges()}>
          <HugeiconsIcon data-icon="inline-start" icon={CheckmarkCircle02Icon} />
          Apply {changes.length} changes
        </Button>
      </CardContent>
    </Card>
  );
}

export { UploadProposedChanges };
