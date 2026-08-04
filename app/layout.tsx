import type { Metadata } from "next"
import { DM_Sans, Inter, Geist_Mono } from "next/font/google"
import Link from "next/link"
import "./globals.css"

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
})

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Nymbus AI Product Recommendations",
  description: "AI-driven product recommendation and account origination tool for retail bankers",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col md:flex-row">
        {/* Mobile top bar — visible only below md */}
        <header className="flex md:hidden items-center justify-between border-b border-border bg-card p-4">
          <h1 className="text-lg font-semibold tracking-tight">Nymbus</h1>
          <nav>
            <Link
              href="/customers"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Customers
            </Link>
          </nav>
        </header>
        {/* Sidebar — hidden below md, visible at md+ */}
        <aside className="hidden md:flex w-64 border-r border-border bg-card flex-col p-4 shrink-0">
          <div className="mb-8">
            <h1 className="text-lg font-semibold tracking-tight">Nymbus</h1>
            <p className="text-xs text-muted-foreground">AI Product Recommendations</p>
          </div>
          <nav className="flex flex-col gap-1">
            <Link
              href="/customers"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Customers
            </Link>
          </nav>
        </aside>
        {/* Main content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </body>
    </html>
  )
}
