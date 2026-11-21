import { Alert } from "./alert";

export type FormState =
  { ok?: boolean; message?: string; errors?: Record<string, string[] | undefined> } | undefined;

export function FormMessage({ state }: { state: FormState }) {
  if (!state?.message) return null;
  return (
    <Alert variant={state.ok ? "success" : "destructive"} aria-live="polite">
      {state.message}
    </Alert>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-sm text-destructive">{errors[0]}</p>;
}
