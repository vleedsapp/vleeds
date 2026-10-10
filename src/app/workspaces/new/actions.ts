"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { optionalText, primaryDomainField, websiteUrlField, workspaceNameField } from "@/lib/config/business-profile";
import { getCurrentUser } from "@/lib/dal";
import { workspacePath } from "@/lib/navigation";
import { isValidSlug, slugify } from "@/lib/slug";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CreateWorkspaceState = {
  error?: string;
  fieldErrors?: Partial<Record<"organizationName" | "name" | "primaryDomain" | "websiteUrl" | "description", string>>;
  values?: Record<string, string>;
};

const schema = z
  .object({
    organizationId: z.union([z.uuid(), z.literal("new")]),
    organizationName: z.string().trim().max(120),
    name: workspaceNameField,
    primaryDomain: primaryDomainField,
    websiteUrl: websiteUrlField,
    description: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.organizationId === "new" && v.organizationName.length === 0) {
      ctx.addIssue({ code: "custom", path: ["organizationName"], message: "Enter an organization name." });
    }
  });

function slugOrFallback(name: string, fallback: string): string {
  const slug = slugify(name);
  return isValidSlug(slug) ? slug : `${fallback}-${randomUUID().slice(0, 6)}`;
}

export async function createWorkspace(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const values = Object.fromEntries(
    ["organizationId", "organizationName", "name", "primaryDomain", "websiteUrl", "description"].map((k) => [
      k,
      String(formData.get(k) ?? ""),
    ]),
  );

  // Server Actions are public endpoints: authenticate here, never trust the form.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = schema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: CreateWorkspaceState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof NonNullable<CreateWorkspaceState["fieldErrors"]>;
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Check the highlighted fields.", fieldErrors, values };
  }

  const input = parsed.data;
  const supabase = await createSupabaseServerClient();

  let organizationId = input.organizationId;
  if (organizationId === "new") {
    const orgSlug = `${slugOrFallback(input.organizationName, "org").slice(0, 57)}-${randomUUID().slice(0, 6)}`;
    const { data, error } = await supabase.rpc("create_organization", {
      p_name: input.organizationName,
      p_slug: orgSlug,
    });
    if (error || !data) {
      console.error("create_organization failed", error);
      return { error: "The organization couldn't be created. Try again.", values };
    }
    organizationId = data;
  }

  // RLS decides whether this user may create workspaces in the organization.
  const { data: workspace, error } = await supabase
    .from("workspaces")
    .insert({
      organization_id: organizationId,
      name: input.name,
      slug: slugOrFallback(input.name, "workspace"),
      primary_domain: input.primaryDomain,
      website_url: input.websiteUrl,
      description: input.description,
    })
    .select("id")
    .single();

  if (error || !workspace) {
    // A new organization may already exist now; re-render so the form offers it instead of creating another.
    if (input.organizationId === "new") refresh();
    if (error?.code === "23505") {
      return {
        error: "A workspace with this name already exists in that organization.",
        fieldErrors: { name: "Choose a different name." },
        values: { ...values, organizationId },
      };
    }
    if (error?.code === "42501") {
      return { error: "You don't have permission to create workspaces in that organization.", values };
    }
    console.error("create workspace failed", error);
    return { error: "The workspace couldn't be created. Try again.", values: { ...values, organizationId } };
  }

  redirect(workspacePath(workspace.id, "settings"));
}
