import { redirect } from "next/navigation"
import { checkAdminCredentials, createAdminSession } from "@/lib/auth"

async function login(formData: FormData) {
	"use server"
	const email = String(formData.get("email") ?? "")
	const password = String(formData.get("password") ?? "")
	if (!checkAdminCredentials(email, password)) redirect("/login?error=1")
	await createAdminSession()
	redirect("/")
}

export default async function LoginPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string }>
}) {
	const { error } = await searchParams
	return (
		<main className="flex min-h-screen items-center justify-center px-4">
			<form action={login} className="card w-full max-w-sm space-y-4">
				<h1 className="text-lg font-semibold">Вход в дашборд</h1>
				{error && (
					<p className="text-sm text-red-400">Неверный email или пароль</p>
				)}
				<div>
					<label className="label" htmlFor="email">
						Email
					</label>
					<input
						className="input"
						id="email"
						name="email"
						type="email"
						required
					/>
				</div>
				<div>
					<label className="label" htmlFor="password">
						Пароль
					</label>
					<input
						className="input"
						id="password"
						name="password"
						type="password"
						required
					/>
				</div>
				<button className="btn w-full" type="submit">
					Войти
				</button>
			</form>
		</main>
	)
}
