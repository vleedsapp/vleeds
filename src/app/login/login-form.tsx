"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/auth/actions";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert, Button, Field, inputClass } from "@/components/ui/primitives";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "/";
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const invalid = state.error ? true : undefined;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state.error ? <Alert>{state.error}</Alert> : null}
      <Field label="Email" htmlFor="email">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.email}
          placeholder="you@company.com"
          className={inputClass}
          aria-invalid={invalid}
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={invalid}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" className="mt-2 w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
