import { Composition, type CalculateMetadataFunction } from "remotion";
import { EditPlanComposition } from "./EditPlanComposition";
import { getSampleProps } from "./sample";
import type { CompositionProps } from "./types";

export const COMPOSITION_ID = "CmfEditPlan";

const calculateMetadata: CalculateMetadataFunction<CompositionProps> = ({ props }) => ({
  width: props.plan.composition.width,
  height: props.plan.composition.height,
  fps: props.plan.composition.fps,
  durationInFrames: props.plan.composition.durationInFrames,
});

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={EditPlanComposition}
    defaultProps={getSampleProps()}
    calculateMetadata={calculateMetadata}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={300}
  />
);
