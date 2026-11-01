import React from 'react';
import { CorrectionBox } from '../CorrectionBox';
import { P, Screen } from '../components';
import { useRepo } from '../state';

/** "Stämmer bedömningen?" as a sheet over the assessment (HIG: a sheet for a simple task). */
export function CorrectionScreen({ assessmentId }: { assessmentId: string }) {
  const repo = useRepo();
  const a = repo.assessments().find((x) => x.id === assessmentId);
  return (
    <Screen title="Stämmer det?">
      {a ? <CorrectionBox assessment={a} /> : <P>Bedömningen finns inte längre.</P>}
    </Screen>
  );
}
