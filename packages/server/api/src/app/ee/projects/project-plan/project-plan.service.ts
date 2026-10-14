import { apId, isNil, spreadIfDefined } from '@inboxfm-connect/core-utils'
import { PiecesFilterType, ProjectPlan, ProjectPlanLimits } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { EntityManager, In } from 'typeorm'
import { repoFactory } from '../../../core/db/repo-factory'
import { ProjectPlanEntity } from './project-plan.entity'

const projectPlanRepo = repoFactory<ProjectPlan>(ProjectPlanEntity)

export const projectLimitsService = (_log: FastifyBaseLogger) => ({
    async upsert(
        planLimits: ProjectPlanLimits,
        projectId: string,
        entityManager?: EntityManager,
    ): Promise<ProjectPlan> {
        const projectPlan = await this.getOrCreateDefaultPlan(projectId, entityManager)
        await projectPlanRepo(entityManager).update(projectPlan.id, {
            ...spreadIfDefined('name', planLimits.nickname),
            ...spreadIfDefined('locked', planLimits.locked),
            ...spreadIfDefined('pieces', planLimits.pieces),
            ...spreadIfDefined('piecesFilterType', planLimits.piecesFilterType),
        })
        return projectPlanRepo().findOneByOrFail({ projectId })
    },

    async getOrCreateDefaultPlan(projectId: string, entityManager?: EntityManager): Promise<ProjectPlan> {
        const existingPlan = await projectPlanRepo(entityManager).findOneBy({ projectId })

        if (!isNil(existingPlan)) {
            return existingPlan
        }

        // The explicit overwrite list only touches the plan columns, never the
        // primary key: the repository `upsert(entity, ['projectId'])` form puts
        // every supplied column that is not a conflict path into the DO UPDATE
        // set — including the freshly generated `id` — so the loser of two
        // concurrent first-writes would rewrite the winner's primary key and
        // silently drop an update racing on the old id.
        await projectPlanRepo(entityManager)
            .createQueryBuilder()
            .insert()
            .into(ProjectPlanEntity)
            .values({
                id: apId(),
                projectId,
                pieces: [],
                piecesFilterType: PiecesFilterType.NONE,
                locked: false,
                name: 'free',
            })
            .orUpdate(['name', 'pieces', 'piecesFilterType', 'locked'], ['projectId'])
            .execute()

        return projectPlanRepo().findOneByOrFail({ projectId })
    },

    async getOrCreateDefaultPlansForProjects(projectIds: string[]): Promise<Map<string, ProjectPlan>> {
        if (projectIds.length === 0) return new Map()

        const existingPlans = await projectPlanRepo().findBy({ 
            projectId: In(projectIds),
        })
        const plansMap = new Map<string, ProjectPlan>(existingPlans.map(p => [p.projectId, p]))

        const projectsWithoutPlans = projectIds.filter(id => !plansMap.has(id))
        
        if (projectsWithoutPlans.length > 0) {
            const newPlans = await Promise.all(
                projectsWithoutPlans.map(projectId => this.getOrCreateDefaultPlan(projectId)),
            )
            newPlans.forEach(plan => plansMap.set(plan.projectId, plan))
        }

        return plansMap
    },

})


