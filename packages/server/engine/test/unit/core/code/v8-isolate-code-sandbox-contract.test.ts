import { unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setIvmForTests, v8IsolateCodeSandbox } from '../../../../src/lib/core/code/v8-isolate-code-sandbox'

// isolated-vm is an optional native dependency (the integration suite skips
// without it, and its CommonJS require bypasses the module-mock registry), so
// these unit tests pin the CONTRACT through the __setIvmForTests seam: which
// limits the sandbox must pass to Isolate#run — the same surface the
// integration suite exercises behaviorally when the dep exists.
const isolateOptions: Array<Record<string, unknown>> = []
const runOptions: Array<Record<string, unknown>> = []

function injectFakeIvm(): void {
    __setIvmForTests({
        Isolate: class {
            constructor(options: Record<string, unknown>) {
                isolateOptions.push(options)
            }

            async createContext(): Promise<unknown> {
                return {
                    global: {
                        set: async () => undefined,
                    },
                }
            }

            async compileScript(): Promise<unknown> {
                return {
                    run: async (_context: unknown, options: Record<string, unknown>) => {
                        runOptions.push(options)
                        return { copy: () => ({ ok: true }) }
                    },
                }
            }

            dispose(): void {
                // intentionally empty
            }
        },
        ExternalCopy: class {
            constructor(private readonly value: unknown) {}
            copyInto(): unknown {
                return this.value
            }
        },
    })
}

describe('v8IsolateCodeSandbox execution limits (injected fake isolated-vm)', () => {
    let codeFile: string

    beforeEach(async () => {
        codeFile = path.join(os.tmpdir(), `v8-sandbox-unit-${Date.now()}-${Math.random().toString(36).slice(2)}.js`)
        await writeFile(codeFile, 'module.exports = { code: async () => 42 }', 'utf8')
        isolateOptions.length = 0
        runOptions.length = 0
        injectFakeIvm()
    })

    afterEach(async () => {
        await unlink(codeFile).catch(() => undefined)
    })

    it('bounds code-module execution with a run timeout', async () => {
        await v8IsolateCodeSandbox.runCodeModule({ codeFilePath: codeFile, inputs: {} })

        const options = runOptions.at(-1)
        // Without a timeout, a synchronous infinite loop in user code never
        // returns: the isolate is never disposed, a core stays pegged, and the
        // only recovery is the parent SIGKILLing the whole engine (the exact
        // failure the expression path already guards against).
        expect(options?.timeout).toBeGreaterThan(0)
    })

    it('keeps bounding expression execution with a run timeout', async () => {
        await v8IsolateCodeSandbox.runScript({ script: '1 + 1', scriptContext: {}, functions: {} })

        const options = runOptions.at(-1)
        expect(options?.timeout).toBeGreaterThan(0)
    })

    it('always creates the isolate with a memory limit', async () => {
        await v8IsolateCodeSandbox.runCodeModule({ codeFilePath: codeFile, inputs: {} })
        await v8IsolateCodeSandbox.runScript({ script: '1 + 1', scriptContext: {}, functions: {} })

        expect(isolateOptions.length).toBe(2)
        for (const options of isolateOptions) {
            expect((options.memoryLimit as number) ?? 0).toBeGreaterThan(0)
        }
    })

    it('disposes the isolate even when execution fails', async () => {
        const dispose = vi.fn()
        __setIvmForTests({
            Isolate: class {
                async createContext(): Promise<unknown> {
                    return { global: { set: async () => undefined } }
                }

                async compileScript(): Promise<unknown> {
                    return {
                        run: async () => {
                            throw new Error('boom')
                        },
                    }
                }

                dispose(): void {
                    dispose()
                }
            },
            ExternalCopy: class {
                constructor(private readonly value: unknown) {}
                copyInto(): unknown {
                    return this.value
                }
            },
        })

        await expect(v8IsolateCodeSandbox.runCodeModule({ codeFilePath: codeFile, inputs: {} })).rejects.toThrow('boom')
        expect(dispose).toHaveBeenCalledTimes(1)
    })
})
