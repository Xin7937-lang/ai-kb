// Layout for the (auth) route group — centered card, no nav.
// Used by /login (S3) and any future auth pages (signup, forgot-password, etc.)

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
