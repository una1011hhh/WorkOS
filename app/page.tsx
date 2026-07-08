import { WorkOS } from "@/components/work-os";

export const dynamic = "force-static";
export const revalidate = false;

export default function Home() {
  return <WorkOS />;
}
