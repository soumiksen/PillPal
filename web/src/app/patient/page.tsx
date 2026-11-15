import { CallApp } from "@/components/call/call-app";
import { callAppMetadata, callAppViewport } from "@/components/call/meta";

export const metadata = callAppMetadata("patient");
export const viewport = callAppViewport;

export default function Page() {
  return <CallApp role="patient" />;
}
