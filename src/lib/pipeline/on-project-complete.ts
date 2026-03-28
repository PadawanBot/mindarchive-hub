import { getById, update } from "@/lib/store";
import type { Project, TopicBankItem } from "@/types";

/**
 * Called when all pipeline steps are completed for a project.
 * Transitions the linked topic bank item from in_production → produced.
 */
export async function onProjectComplete(projectId: string): Promise<void> {
  try {
    const project = await getById<Project>("projects", projectId);
    if (!project) return;

    const topicBankId = (project.metadata as Record<string, unknown>)?.topic_bank_id as string | undefined;
    if (!topicBankId) return;

    await update<TopicBankItem>("topic_bank", topicBankId, {
      status: "produced",
    } as Partial<TopicBankItem>);

    console.log(`[topic-bank] Topic ${topicBankId} → produced (project ${projectId} completed)`);
  } catch (err) {
    console.error("[topic-bank] Failed to transition topic to produced:", err);
  }
}
