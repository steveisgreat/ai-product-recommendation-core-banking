import Link from "next/link"

export default function CustomerNotFound() {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-xl font-semibold">Customer Not Found</h2>
      <p className="text-sm text-muted-foreground">
        The customer you're looking for doesn't exist or has been removed.
      </p>
      <Link
        href="/customers"
        className="text-sm text-primary hover:underline"
      >
        ← Back to customer list
      </Link>
    </div>
  )
}
