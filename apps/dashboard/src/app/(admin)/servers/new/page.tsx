import { createServer } from "../actions"
import { ServerForm } from "../server-form"

export default function NewServerPage() {
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">Новый сервер</h1>
			<ServerForm action={createServer} submitLabel="Сохранить" />
		</div>
	)
}
