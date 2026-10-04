import { desc, ilike } from "drizzle-orm"
import { db, schema } from "@/db"
import { grantPremium, revokePremium, setBanned } from "./actions"

export const dynamic = "force-dynamic"

const fmt = (d: Date | null) => (d ? d.toLocaleString("ru-RU") : "—")

export default async function DevicesPage({
	searchParams,
}: {
	searchParams: Promise<{ q?: string }>
}) {
	const { q } = await searchParams
	const now = new Date()
	const rows = await db
		.select()
		.from(schema.devices)
		.where(q ? ilike(schema.devices.installId, `%${q.trim()}%`) : undefined)
		.orderBy(desc(schema.devices.lastSeenAt))
		.limit(200)

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-3">
				<h1 className="text-xl font-semibold">Пользователи</h1>
				<form className="ml-auto">
					<input
						className="input w-72"
						name="q"
						defaultValue={q}
						placeholder="Поиск по install id"
					/>
				</form>
			</div>
			<div className="card overflow-x-auto p-0">
				<table className="w-full min-w-[860px]">
					<thead>
						<tr>
							<th className="th">Install ID</th>
							<th className="th">Премиум до</th>
							<th className="th">Free до</th>
							<th className="th">Был в сети</th>
							<th className="th" />
						</tr>
					</thead>
					<tbody>
						{rows.map((d) => {
							const premium = d.premiumUntil && d.premiumUntil > now
							return (
								<tr key={d.id} className={d.banned ? "opacity-50" : ""}>
									<td className="td font-mono text-xs">
										{d.installId}
										<div className="text-zinc-500">
											{d.platform} {d.appVersion ?? ""}
											{d.banned ? " · заблокирован" : ""}
										</div>
									</td>
									<td className="td text-xs">
										<span
											className={premium ? "text-emerald-400" : "text-zinc-500"}
										>
											{fmt(d.premiumUntil)}
										</span>
										{d.premiumSource && (
											<div className="text-zinc-500">{d.premiumSource}</div>
										)}
									</td>
									<td className="td text-xs">{fmt(d.freeUntil)}</td>
									<td className="td text-xs">{fmt(d.lastSeenAt)}</td>
									<td className="td">
										<div className="flex justify-end gap-2">
											<form
												action={grantPremium.bind(null, d.id)}
												className="flex gap-1"
											>
												<input
													className="input w-16"
													name="days"
													type="number"
													defaultValue={30}
													min={1}
												/>
												<button className="btn-ghost" type="submit">
													+ дни
												</button>
											</form>
											{premium && (
												<form action={revokePremium.bind(null, d.id)}>
													<button className="btn-ghost" type="submit">
														Снять
													</button>
												</form>
											)}
											<form action={setBanned.bind(null, d.id, !d.banned)}>
												<button className="btn-danger" type="submit">
													{d.banned ? "Разбан" : "Бан"}
												</button>
											</form>
										</div>
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
		</div>
	)
}
