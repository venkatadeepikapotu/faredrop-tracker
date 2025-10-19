import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FareDrop Tracker',
  description: 'Flight price monitoring system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}