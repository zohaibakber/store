export function AuthModeToggle({
  mode,
  onToggle,
}: {
  mode: "sign-in" | "sign-up";
  onToggle: () => void;
}) {
  return mode === "sign-in" ? (
    <>
      Don&apos;t have an account?{" "}
      <button type="button" className="underline underline-offset-4" onClick={onToggle}>
        Sign up
      </button>
    </>
  ) : (
    <>
      Already have an account?{" "}
      <button type="button" className="underline underline-offset-4" onClick={onToggle}>
        Sign in
      </button>
    </>
  );
}
