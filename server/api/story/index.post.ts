import {CallFrame, RunFrame, Frame, GPTScript, RunEventType} from '@gptscript-ai/gptscript'
import {Readable} from 'stream'
import type {StoryRequest, StreamEvent} from '@/lib/types'

export const runningScripts: Record<string, string> = {}
export const eventStream = new Readable({
    read() {
    }
});
const gptscript = new GPTScript()

export default defineEventHandler(async (event) => {
    const request = await readBody(event) as StoryRequest

    // Ensure that the request has the required fields
    if (!request.prompt) {
        throw createError({
            statusCode: 400,
            statusMessage: 'prompt is required'
        })
    }
    if (!request.pages) {
        throw createError({
            statusCode: 400,
            statusMessage: 'pages are required'
        })
    }

    console.log(`generating story for: ${JSON.stringify(request)}`)

    // Run the script with the given prompt and number of pages
    const {storiesVolumePath, scriptPath, gptscriptCachePath} = useRuntimeConfig()
    const opts = {
        input: `--story ${request.prompt} --pages ${request.pages} --path ${storiesVolumePath}`,
        credentialOverrides: ['sys.openai:OPENAI_API_KEY'],
        cacheDir: gptscriptCachePath,
        includeEvents: true
    }

    // Generate an ID and add it to the runningScripts object
    const id = Math.random().toString(36).substring(2, 14);
    runningScripts[id] = request.prompt

    const run = await gptscript.run(scriptPath, opts)
    run.on(RunEventType.Event, (e: Frame) => {
        let event: StreamEvent
        switch (e.type) {
            case RunEventType.CallStart:
            case RunEventType.CallFinish:
                e = e as CallFrame
                let message: string = ""
                if (e.output && e.output.length > 0) {
                    message = JSON.stringify(e.output)
                }
                if (e.error && e.error != "") {
                    message = e.error
                }
                if (message == "") {
                    return
                }

                event = {
                    id: id,
                    message: message,
                    error: !!e.error,
                    final: false
                }
                break
            default:
                return
        }

        eventStream.push(`data: ${JSON.stringify(event)}\n\n`)
    })

    run.text()
        .then((output) => {
            const event: StreamEvent = {
                id: id,
                message: output,
                final: true,
                error: false
            }
            run.close()
            eventStream.push(`data: ${JSON.stringify(event)}\n\n`)
        })
        .catch((err) => {
            const event: StreamEvent = {
                id: id,
                message: err,
                final: true,
                error: true,
            }
            eventStream.push(`data: ${JSON.stringify(event)}\n\n`)
        })
        .finally(() => {
            run.close()
            delete runningScripts[id]
        })

    setResponseStatus(event, 202)
})
