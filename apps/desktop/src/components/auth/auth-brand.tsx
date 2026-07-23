export function AuthBrand() {
  return (
    <span className="flex text-lg items-center gap-2 font-medium">
      {/* vite-plugin-electron builds with base: "./" so the packaged app can
          load index.html via file://; a root-absolute "/logo.svg" would
          resolve to the filesystem root instead of the public dir. */}
      <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="size-6 rounded-md" />
      Tabaaq
    </span>
  );
}
