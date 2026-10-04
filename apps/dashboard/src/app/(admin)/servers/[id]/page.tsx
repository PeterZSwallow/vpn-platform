import { eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { db, schema } from "@/db"
import { deleteServer, updateServer } from "../actions"
import { ServerForm } from "../server-form"

export default async function EditServerPage({
	params,
}: {
	params: Promise<{ id: string }>
}) {
	const { id } = await params
	const server = await db.query.servers
		.findFirst({ where: eq(schema.servers.id, id) })
		.catch(() => undefined)
	if (!server) notFound()

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<h1 className="text-xl font-semibold">{server.name}</h1>
				<form action={deleteServer.bind(null, server.id)} className="ml-auto">
					<button className="btn-danger" type="submit">
						Удалить
					</button>
				</form>
			</div>
			<ServerForm
				action={updateServer.bind(null, server.id)}
				server={server}
				submitLabel="Сохранить"
			/>
		</div>
	)
}
