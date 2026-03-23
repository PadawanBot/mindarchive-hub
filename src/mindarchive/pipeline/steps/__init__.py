"""Pipeline step implementations and factory."""

from __future__ import annotations

from typing import Any

from mindarchive.pipeline.step_base import PipelineStep


def create_all_steps(llm: Any, prompt_manager: Any) -> dict[int, PipelineStep]:
    """Create instances of all 15 pipeline steps.

    Args:
        llm: An AnthropicLLM instance (or any LLMProvider).
        prompt_manager: A PromptManager instance.

    Returns:
        Dict mapping step number → step instance.
    """
    from mindarchive.pipeline.steps.step_01_topic_miner import TopicMiner
    from mindarchive.pipeline.steps.step_02_scriptwriter import Scriptwriter
    from mindarchive.pipeline.steps.step_03_hook_generator import HookGenerator
    from mindarchive.pipeline.steps.step_04_voice_crafter import VoiceCrafter
    from mindarchive.pipeline.steps.step_05_visual_direction import VisualDirectionMapper
    from mindarchive.pipeline.steps.step_06_blend_curator import BlendCurator
    from mindarchive.pipeline.steps.step_07_brand_builder import BrandBuilder
    from mindarchive.pipeline.steps.step_08_script_edit_loop import ScriptEditLoop
    from mindarchive.pipeline.steps.step_09_timing_sync import TimingSync
    from mindarchive.pipeline.steps.step_10_thumbnail import ThumbnailArchitect
    from mindarchive.pipeline.steps.step_11_retention import RetentionDesigner
    from mindarchive.pipeline.steps.step_12_comment_magnet import CommentMagnet
    from mindarchive.pipeline.steps.step_13_upload_blueprint import UploadBlueprint
    from mindarchive.pipeline.steps.step_14_scheduler import ConsistencyScheduler
    from mindarchive.pipeline.steps.step_15_monetization import MonetizationMap

    return {
        1: TopicMiner(llm, prompt_manager),
        2: Scriptwriter(llm, prompt_manager),
        3: HookGenerator(llm, prompt_manager),
        4: VoiceCrafter(llm, prompt_manager),
        5: VisualDirectionMapper(llm, prompt_manager),
        6: BlendCurator(llm, prompt_manager),
        7: BrandBuilder(llm, prompt_manager),
        8: ScriptEditLoop(llm, prompt_manager),
        9: TimingSync(llm, prompt_manager),
        10: ThumbnailArchitect(llm, prompt_manager),
        11: RetentionDesigner(llm, prompt_manager),
        12: CommentMagnet(llm, prompt_manager),
        13: UploadBlueprint(llm, prompt_manager),
        14: ConsistencyScheduler(llm, prompt_manager),
        15: MonetizationMap(llm, prompt_manager),
    }
