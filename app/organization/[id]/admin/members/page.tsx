import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export const metadata = {
  title: "Members",
};

/**
 * The standalone members directory moved into the organization's Members tab,
 * which now carries its email, status and last activity columns for staff and
 * admins. This route stays so existing links keep working.
 */
export default async function MembersPage({ params }: Props) {
  const { id } = await params;
  redirect(`/organization/${encodeURIComponent(id)}?tab=members`);
}
