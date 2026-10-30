import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { wideEvent } from '../src/wide-event'
import { apLogger } from '../src/ap-logger'
import { createLogger, initLogger, mockAudit } from 'evlog'
import type { RequestLogger } from 'evlog'

function makeMockLogger(): RequestLogger & {
    _sets: Record<string, unknown>[]
    _infos: [string, Record<string, unknown>?][]
    _errors: [Error | string, Record<string, unknown>?][]
    emit: () => null
} {
    const _sets: Record<string, unknown>[] = []
    const _infos: [string, Record<string, unknown>?][] = []
    const _errors: [Error | string, Record<string, unknown>?][] = []
    return {
        _sets,
        _infos,
        _errors,
        set(fields) { _sets.push(fields as Record<string, unknown>) },
        setLevel: vi.fn(),
        error(err, ctx?) { _errors.push([err, ctx as Record<string, unknown>]) },
        info(msg, ctx?) { _infos.push([msg, ctx as Record<string, unknown>]) },
        warn: vi.fn(),
        emit: () => null,
        getContext: () => ({}),
    }
}

describe('wideEvent', () => {
    beforeEach(() => {
        // no global state to reset — ALS is scoped per run()
    })

    it('current() returns undefined outside of a run()', () => {
        expect(wideEvent.current()).toBeUndefined()
    })

    it('set() is a no-op outside of a run()', () => {
        // Should not throw
        expect(() => wideEvent.set({ foo: 'bar' })).not.toThrow()
    })

    it('run() makes the logger accessible via current()', () => {
        const logger = makeMockLogger()
        wideEvent.run({
            logger,
            fn: () => {
                expect(wideEvent.current()).toBe(logger)
            },
        })
    })

    it('set() calls logger.set() within a run()', () => {
        const logger = makeMockLogger()
        wideEvent.run({
            logger,
            fn: () => {
                wideEvent.set({ requestId: 'abc' })
            },
        })
        expect(logger._sets).toHaveLength(1)
        expect(logger._sets[0]).toEqual({ requestId: 'abc' })
    })

    it('error() wraps a non-Error value', () => {
        const logger = makeMockLogger()
        wideEvent.run({
            logger,
            fn: () => {
                wideEvent.error('something went wrong')
            },
        })
        expect(logger._errors).toHaveLength(1)
        const [err] = logger._errors[0]
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toBe('something went wrong')
    })

    it('error() passes an existing Error directly', () => {
        const logger = makeMockLogger()
        const original = new Error('original')
        wideEvent.run({
            logger,
            fn: () => {
                wideEvent.error(original)
            },
        })
        expect(logger._errors[0][0]).toBe(original)
    })

    it('error() is a no-op outside a run()', () => {
        expect(() => wideEvent.error(new Error('boom'))).not.toThrow()
    })

    it('timed() records duration and returns result', async () => {
        const logger = makeMockLogger()
        const result = await wideEvent.run({
            logger,
            fn: () => wideEvent.timed({
                name: 'db',
                fn: async () => 42,
            }),
        })
        expect(result).toBe(42)
        const timingSet = logger._sets.find((s) => s['timings'] !== undefined)
        expect(timingSet).toBeDefined()
        expect((timingSet?.['timings'] as Record<string, unknown>)?.['dbMs']).toBeTypeOf('number')
    })

    it('timed() records timing and rethrows on error', async () => {
        const logger = makeMockLogger()
        await expect(
            wideEvent.run({
                logger,
                fn: () => wideEvent.timed({
                    name: 'slow',
                    fn: async () => {
                        throw new Error('timed failure')
                    },
                }),
            }),
        ).rejects.toThrow('timed failure')

        const timingSet = logger._sets.find((s) => s['timings'] !== undefined)
        expect(timingSet).toBeDefined()
        expect((timingSet?.['timings'] as Record<string, unknown>)?.['slowMs']).toBeTypeOf('number')
    })

    it('timed() is a no-op outside a run() (no ambient logger)', async () => {
        const result = await wideEvent.timed({ name: 'test', fn: async () => 'val' })
        expect(result).toBe('val')
    })

    it('multiple timed() calls accumulate under the shared timings key on a real evlog logger', async () => {
        // Uses the real evlog RequestLogger (not a mock) to verify that
        // sequential timed() calls deep-merge instead of overwriting each
        // other — e.g. provisioner.ts writes four timings in one job event.
        initLogger({ env: { service: 'wide-event-test' }, silent: true })
        const logger = createLogger({ event: 'job.test' })
        await wideEvent.run({
            logger,
            fn: async () => {
                await wideEvent.timed({ name: 'installCode', fn: async () => 'a' })
                await wideEvent.timed({ name: 'installEngine', fn: async () => 'b' })
                await wideEvent.timed({ name: 'provision', fn: async () => 'c' })
            },
        })
        const emitted = logger.emit()
        expect(emitted).toMatchObject({
            timings: {
                installCodeMs: expect.any(Number),
                installEngineMs: expect.any(Number),
                provisionMs: expect.any(Number),
            },
        })
    })

    it('audit() attaches audit fields to the ambient request logger', async () => {
        initLogger({ env: { service: 'wide-event-test' }, silent: true })
        const logger = createLogger({ event: 'request' })
        await wideEvent.run({
            logger,
            fn: async () => {
                wideEvent.audit({
                    action: 'connection.listed',
                    actor: { type: 'user', id: 'usr_1' },
                    target: { type: 'project', id: 'proj_1' },
                })
            },
        })
        const emitted = logger.emit()
        expect(emitted).toMatchObject({
            audit: {
                action: 'connection.listed',
                actor: { type: 'user', id: 'usr_1' },
                target: { type: 'project', id: 'proj_1' },
                outcome: 'success',
            },
        })
    })

    it('audit() emits a standalone audit event outside a run()', () => {
        initLogger({ env: { service: 'wide-event-test' }, silent: true })
        const captured = mockAudit()
        wideEvent.audit({
            action: 'cron.cleanup',
            actor: { type: 'system', id: 'cron' },
        })
        expect(captured.toIncludeAuditOf({
            action: 'cron.cleanup',
            outcome: 'success',
        })).toBe(true)
        captured.restore()
    })
})

describe('wideEvent prototype-pollution guard (real evlog merge)', () => {
    // evlog's RequestLogger.set()/info()/warn()/error() merge field records
    // into the wide-event context with a recursive assign that resolves a
    // `__proto__` key against Object.prototype. A JSON.parse'd payload can
    // carry an own enumerable `__proto__` data property, so one set() call can
    // pollute Object.prototype for the whole process. These tests run against
    // the REAL evlog logger (not a mock) to prove the merge path is safe.
    afterEach(() => {
        // scrub any pollution a regression would leave behind
        delete (Object.prototype as unknown as Record<string, unknown>)['polluted']
    })

    function makeRealLogger(event: string) {
        initLogger({ env: { service: 'wide-event-test' }, silent: true })
        return createLogger({ event })
    }

    it('set() with a __proto__ payload does not pollute Object.prototype and keeps clean fields', () => {
        const logger = makeRealLogger('request')
        const payload = JSON.parse('{"__proto__": {"polluted": "yes"}, "requestId": "abc-1"}')
        wideEvent.run({
            logger,
            fn: () => {
                wideEvent.set(payload)
            },
        })
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
        expect(logger.emit()).toMatchObject({ requestId: 'abc-1' })
    })

    it('set() strips nested __proto__/constructor/prototype keys but keeps sibling data', () => {
        const logger = makeRealLogger('request')
        const payload = JSON.parse('{"outer": {"__proto__": {"polluted": "yes"}, "keep": 1}, "constructor": {"polluted": "also"}, "top": true}')
        wideEvent.run({
            logger,
            fn: () => {
                wideEvent.set(payload)
            },
        })
        const emitted = logger.emit() as unknown as Record<string, unknown>
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
        expect(emitted).toMatchObject({ top: true, outer: { keep: 1 } })
        // no dangerous key survived at the top level or inside the nested object
        const topLevelKeys = Object.keys(emitted)
        expect(topLevelKeys).toContain('outer')
        expect(topLevelKeys).toContain('top')
        expect(topLevelKeys).not.toContain('__proto__')
        expect(topLevelKeys).not.toContain('constructor')
        expect(topLevelKeys).not.toContain('prototype')
        expect(Object.keys(emitted['outer'] as object).sort()).toEqual(['keep'])
        // the caller's nested object is not mutated by the sanitizer (it is
        // cloned with the dangerous key dropped, not edited in place)
        expect(Object.prototype.hasOwnProperty.call((payload as Record<string, unknown>)['outer'], '__proto__')).toBe(true)
    })

    it('apLogger field merge on the wide path cannot pollute Object.prototype', () => {
        const logger = makeRealLogger('request')
        wideEvent.run({
            logger,
            fn: () => {
                apLogger.create({}).info(JSON.parse('{"__proto__": {"polluted": "yes"}, "userId": "u1"}'), 'user found')
            },
        })
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
        expect(logger.emit()).toMatchObject({ userId: 'u1' })
    })

    it('audit() target payloads cannot pollute Object.prototype on the second audit merge', () => {
        const logger = makeRealLogger('request')
        wideEvent.run({
            logger,
            fn: () => {
                wideEvent.audit({
                    action: 'first',
                    actor: { type: 'user', id: 'usr_1' },
                    target: { type: 'project', id: 'p1' },
                })
                wideEvent.audit({
                    action: 'second',
                    target: JSON.parse('{"__proto__": {"polluted": "yes"}, "id": "p2"}'),
                } as never)
            },
        })
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    })
})
