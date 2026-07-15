import { Field, FieldLabel } from "@/components/ui/field";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";
import { useUpload, type GatewayModel, type ModelGroup } from "./upload-context";

function UploadModelPicker() {
  const {
    state: { model },
    actions: { setModel },
    meta: { groupedModels },
  } = useUpload();

  return (
    <Field>
      <FieldLabel htmlFor="invoice-model">Invoice model</FieldLabel>
      <Combobox
        items={groupedModels}
        value={model}
        isItemEqualToValue={(item: GatewayModel, value: GatewayModel) => item.id === value.id}
        itemToStringLabel={(item: GatewayModel) => item.name ?? item.id}
        onValueChange={(value: GatewayModel | null) => value && setModel(value)}
      >
        <ComboboxInput id="invoice-model" className="w-full" placeholder="Search models…" />
        <ComboboxContent>
          <ComboboxEmpty>No matching models.</ComboboxEmpty>
          <ComboboxList>
            {(group: ModelGroup) => (
              <ComboboxGroup key={group.provider} items={group.items}>
                <ComboboxLabel>{group.label}</ComboboxLabel>
                <ComboboxCollection>
                  {(item: GatewayModel) => (
                    <ComboboxItem key={item.id} value={item}>
                      {item.name ?? item.id}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}

export { UploadModelPicker };
