"use client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

const CompleteProfileButton: React.FC = () => {
  const router = useRouter();
  return (
    <Button onClick={() => router.push("/account/profile")}>
      Complete Profile
    </Button>
  );
};

export default CompleteProfileButton;
