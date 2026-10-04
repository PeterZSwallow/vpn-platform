import { asc } from "drizzle-orm"
import { headers } from "next/headers"
import Link from "next/link"
import { db, schema } from "@/db"
import { checkServersNow, testServerPanel, toggleServer } from "./actions"

export const dynamic = "force-dynamic"

const statusColor = {
	online: "bg-emerald-500",
	offline: "bg-red-500",
	unknown: "bg-zinc-500",
} as const

export default async function ServersPage() {
	const rows = await db
		.select()
		.from(schema.servers)
		.orderBy(asc(schema.servers.sortOrder), asc(schema.servers.name))

	const h = await headers()
	const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`
	const regToken = process.env.NODE_REGISTRATION_TOKEN
	const installCmd = `curl -fsSL ${origin}/install.sh | sudo bash -s -- \\\n  --dashboard ${origin} --token ${regToken} \\\n  --country NL --city Amsterdam --name "Netherlands #1"`

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="text-xl font-semibold">Серверы</h1>
				<form action={checkServersNow} className="ml-auto">
					<button className="btn-ghost" type="submit">
						Проверить все
					</button>
				</form>
				<Link href="/servers/new" className="btn">
					+ Добавить сервер
				</Link>
			</div>

			<details className="card" open={rows.length === 0}>
				<summary className="cursor-pointer font-medium">
					Установить новую ноду одной командой
				</summary>
				{regToken ? (
					<div className="mt-3 space-y-2 text-sm text-zinc-400">
						<p>
							Выполните на чистом VPS (Ubuntu/Debian) под root. Скрипт поставит
							3x-ui и Xray, создаст VLESS + Reality inbound и сам добавит сервер
							в этот список.
						</p>
						<pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-emerald-300">
							{installCmd}
						</pre>
						<p className="text-xs">
							Другие опции: <code>--tier premium</code>, <code>--sni</code>,{" "}
							<code>--port</code>, <code>--panel-port</code>. Порт панели должен
							быть доступен с сервера дашборда.
						</p>
					</div>
				) : (
					<p className="mt-3 text-sm text-zinc-400">
						Задайте <code>NODE_REGISTRATION_TOKEN</code> в .env дашборда, чтобы
						ноды могли регистрироваться автоматически.
					</p>
				)}
			</details>

			<div className="card overflow-x-auto p-0">
				<table className="w-full min-w-[720px]">
					<thead>
						<tr>
							<th className="th">Сервер</th>
							<th className="th">Адрес</th>
							<th className="th">Тариф</th>
							<th className="th">Панель</th>
							<th className="th">Статус</th>
							<th className="th" />
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 && (
							<tr>
								<td className="td text-zinc-500" colSpan={6}>
									Серверов пока нет. Добавьте первый.
								</td>
							</tr>
						)}
						{rows.map((s) => (
							<tr key={s.id} className={s.enabled ? "" : "opacity-50"}>
								<td className="td">
									<Link
										href={`/servers/${s.id}`}
										className="font-medium hover:underline"
									>
										{s.name}
									</Link>
									<div className="text-xs text-zinc-500">
										{s.countryCode}
										{s.city ? ` · ${s.city}` : ""}
									</div>
								</td>
								<td className="td font-mono text-xs">
									{s.host}:{s.port}
								</td>
								<td className="td">
									{s.tier === "premium" ? "Премиум" : "Free"}
								</td>
								<td className="td text-xs">{s.panelType}</td>
								<td className="td">
									<div className="flex items-center gap-2">
										<span
											className={`h-2 w-2 rounded-full ${statusColor[s.status]}`}
										/>
										<span className="text-xs">
											{s.status}
											{s.latencyMs != null && s.status === "online"
												? ` · ${s.latencyMs} ms`
												: ""}
										</span>
									</div>
									{s.lastError && (
										<div
											className="mt-1 max-w-56 truncate text-xs text-red-400"
											title={s.lastError}
										>
											{s.lastError}
										</div>
									)}
								</td>
								<td className="td">
									<div className="flex justify-end gap-2">
										<form action={testServerPanel.bind(null, s.id)}>
											<button className="btn-ghost" type="submit">
												Тест
											</button>
										</form>
										<form action={toggleServer.bind(null, s.id, !s.enabled)}>
											<button className="btn-ghost" type="submit">
												{s.enabled ? "Выкл" : "Вкл"}
											</button>
										</form>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
