"use client";

import { useActionState, useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui/primitives";
import type { AdminOrganization } from "@/lib/dal";
import { createWorkspace, type CreateWorkspaceState } from "./actions";

export function NewWorkspaceForm({ organizations }: { organizations: AdminOrganization[] }) {
  const [state, action, pending] = useActionState<CreateWorkspaceState, FormData>(createWorkspace, {});
  const [orgChoice, setOrgChoice] = useState(organizations[0]?.id ?? "new");
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};

  // Keep the selection in sync if the server created an organization on a failed attempt.
  const [lastValues, setLastValues] = useState(state.values);
  if (lastValues !== state.values) {
    setLastValues(state.values);
    if (state.values?.organizationId) setOrgChoice(state.values.organizationId);
  }

  const creatingOrg = orgChoice === "new";

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}

      {organizations.length > 0 ? (
        <Field label="Organization" htmlFor="organizationId" hint="Members of the organization can access its workspaces.">
          <select
            id="organizationId"
            name="organizationId"
            value={orgChoice}
            onChange={(e) => setOrgChoice(e.target.value)}
            className={inputClass}
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
            <option value="new">Create a new organization…</option>
          </select>
        </Field>
      ) : (
        <input type="hidden" name="organizationId" value="new" />
      )}

      {creatingOrg ? (
        <Field
          label="Organization name"
          htmlFor="organizationName"
          error={fe.organizationName}
          hint="The company or team that owns this workspace. You will be its owner."
        >
          <input
            id="organizationName"
            name="organizationName"
            defaultValue={v.organizationName}
            maxLength={120}
            className={inputClass}
            aria-invalid={fe.organizationName ? true : undefined}
          aria-describedby={fe.organizationName ? "organizationName-error" : undefined}
          />
        </Field>
      ) : (
        <input type="hidden" name="organizationName" value="" />
      )}

      <Field
        label="Workspace name"
        htmlFor="name"
        error={fe.name}
        hint="Usually the business or brand you are prospecting for."
      >
        <input
          id="name"
          name="name"
          defaultValue={v.name}
          maxLength={120}
          required
          className={inputClass}
          aria-invalid={fe.name ? true : undefined}
          aria-describedby={fe.name ? "name-error" : undefined}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Primary domain" htmlFor="primaryDomain" error={fe.primaryDomain} optional>
          <input
            id="primaryDomain"
            name="primaryDomain"
            defaultValue={v.primaryDomain}
            placeholder="example.com"
            className={inputClass}
            aria-invalid={fe.primaryDomain ? true : undefined}
          aria-describedby={fe.primaryDomain ? "primaryDomain-error" : undefined}
          />
        </Field>
        <Field label="Website" htmlFor="websiteUrl" error={fe.websiteUrl} optional>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            defaultValue={v.websiteUrl}
            placeholder="https://"
            className={inputClass}
            aria-invalid={fe.websiteUrl ? true : undefined}
          aria-describedby={fe.websiteUrl ? "websiteUrl-error" : undefined}
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="description" error={fe.description} optional hint="What this business offers.">
        <textarea
          id="description"
          name="description"
          defaultValue={v.description}
          maxLength={2000}
          rows={3}
          className={`${inputClass} h-auto py-2`}
          aria-invalid={fe.description ? true : undefined}
          aria-describedby={fe.description ? "description-error" : undefined}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Creating…" : "Create workspace"}
        </Button>
      </div>
    </form>
  );
}
