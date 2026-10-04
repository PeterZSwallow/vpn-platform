import Link from "next/link"
import { redirect } from "next/navigation"
import { destroyAdminSession, requireAdmin } from "@/lib/auth"

async function logout() {
	"use server"
	await destroyAdminSession()
	redirect("/login")
}

const nav = [
	{ href: "/", label: "Обзор" },
	{ href: "/servers", label: "Серверы" },
	{ href: "/devices", label: "Пользователи" },
	{ href: "/events", label: "Платежи" },
	{ href: "/settings", label: "Настройки" },
]

export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode
}) {
	await requireAdmin()
	return (
		<div className="mx-auto max-w-6xl px-4 py-6">
			<header className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
				<span className="font-semibold text-emerald-400">VPN Admin</span>
				<nav className="flex flex-wrap gap-4 text-sm text-zinc-300">
					{nav.map((n) => (
						<Link key={n.href} href={n.href} className="hover:text-white">
							{n.label}
						</Link>
					))}
				</nav>
				<form action={logout} className="ml-auto">
					<button className="btn-ghost" type="submit">
						Выйти
					</button>
				</form>
			</header>
			{children}
		</div>
	)
}
