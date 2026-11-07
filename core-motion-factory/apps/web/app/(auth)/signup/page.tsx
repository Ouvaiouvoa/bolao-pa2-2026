import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Criar organização" };
export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
