import { asc } from "drizzle-orm"
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
