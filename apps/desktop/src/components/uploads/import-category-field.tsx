import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useUpload } from "./context";

function UploadImportCategoryField() {
  const {
    state: { categories, category },
    actions: { chooseCategory, nameCategory },
    meta: { processing },
  } = useUpload();
  const id = useId();
  const items = categories.map((known) => ({ label: known.name, value: known.id }));

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label htmlFor={id}>
        {category._tag === "New" ? "New products go into a new category" : "New products go into"}
      </Label>
      {category._tag === "New" ? (
        <Input
          className="w-56"
          disabled={processing}
          id={id}
          onChange={(event) => nameCategory(event.currentTarget.value)}
          placeholder="Category name"
          value={category.name}
          size="sm"
        />
      ) : (
        <Select
          disabled={processing}
          items={items}
          onValueChange={(next) => next && chooseCategory(next)}
          value={category.id}
        >
          <SelectTrigger className="w-56" id={id} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export { UploadImportCategoryField };
