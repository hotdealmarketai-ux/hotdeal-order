import { requireVendor } from "@/lib/session";

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireVendor();
  return <div className="app">{children}</div>;
}
