import { desc } from "drizzle-orm"
import { db, schema } from "@/db"

export const dynamic = "force-dynamic"

export default async function EventsPage() {
	const rows = await db
		.select()
		.from(schema.billingEvents)
		.orderBy(desc(schema.billingEvents.createdAt))
		.limit(100)

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">Платёжные события</h1>
			<div className="card overflow-x-auto p-0">
				<table className="w-full min-w-[720px]">
					<thead>
						<tr>
							<th className="th">Время</th>
							<th className="th">Провайдер</th>
							<th className="th">Событие</th>
							<th className="th">Install ID</th>
							<th className="th">Данные</th>
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 && (
							<tr>
								<td className="td text-zinc-500" colSpan={5}>
									Событий пока нет
								</td>
							</tr>
						)}
						{rows.map((e) => (
							<tr key={e.id}>
								<td className="td text-xs">
									{e.createdAt.toLocaleString("ru-RU")}
								</td>
								<td className="td text-xs">{e.provider}</td>
								<td className="td text-xs">{e.type}</td>
								<td className="td font-mono text-xs">{e.installId ?? "—"}</td>
								<td className="td">
									<details>
										<summary className="cursor-pointer text-xs text-zinc-400">
											JSON
										</summary>
										<pre className="mt-2 max-h-64 max-w-xl overflow-auto text-xs">
											{JSON.stringify(e.payload, null, 2)}
										</pre>
									</details>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
