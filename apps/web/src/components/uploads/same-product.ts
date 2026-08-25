export const sameProduct = (
  line: { readonly name: string; readonly unitsPerPack: number },
  product: { readonly name: string; readonly unitsPerPack: number },
) =>
  product.name.trim().toLocaleLowerCase() === line.name.trim().toLocaleLowerCase() &&
  product.unitsPerPack === line.unitsPerPack;
