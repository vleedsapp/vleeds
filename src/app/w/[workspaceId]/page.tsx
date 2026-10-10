import { redirect } from "next/navigation";
import { workspacePath } from "@/lib/navigation";

export default async function WorkspaceIndex({ params }: PageProps<"/w/[workspaceId]">) {
  const { workspaceId } = await params;
  redirect(workspacePath(workspaceId));
}
