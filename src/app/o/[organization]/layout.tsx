import { WorkspaceStateProvider } from "@/components/workspace-state";

export default async function OrganizationLayout({ children, params }: {
  children: React.ReactNode;
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  return (
    <WorkspaceStateProvider key={organization} organizationSlug={organization}>
      {children}
    </WorkspaceStateProvider>
  );
}
