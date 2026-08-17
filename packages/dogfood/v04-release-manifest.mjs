export const releaseManifest = Object.freeze({
  schemaVersion: 1,
  algorithm: 'sha256',
  modules: Object.freeze([
    { role: 'browser-document', path: 'apps/workbench/public/v04-lab.html', sha256: 'b97132b12e01b9c3e10765890734c1ef5dd05583bfa5fb19b1ec34390081ec20' },
    { role: 'bootstrap', path: 'apps/workbench/src/v04-lab-main.tsx', sha256: '9c8520540e62476d15484689bc03bdf16986aa2120b29a3746a41eea083fa2a4' },
    { role: 'calibration-fixture', path: 'apps/workbench/src/V04Lab.tsx', sha256: 'a7db1064c879f889f80e6631e9a50dd02d26b974a3184d7c60c32b7a75ab4f52' },
    { role: 'repository-truth', path: 'packages/dogfood/lab-v04-truth.mjs', sha256: 'ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9' },
    { role: 'release-runner-checker', path: 'packages/dogfood/lab-v04.mjs', sha256: '1d65d4c98d5c3f71500e407c7c7e24e1e52a01be07564c7ee50773fb52030cf0' },
    { role: 'release-contract-tests', path: 'packages/dogfood/lab-v04.test.mjs', sha256: '8f2ffbdfd52168537f890c064e4b1e6044107ce2cbcd496b1ac0d7c7a60c9281' },
    { role: 'evidence-directory', path: 'packages/dogfood/v04-evidence-run.mjs', sha256: '9fd8ae5bb77c481b7d526e5e5a739b101a2141c4d8b4f6478c9422e33d624ff3' },
    { role: 'targeted-runner', path: 'packages/dogfood/v04-heavy-negative-probe.mjs', sha256: '950c2085cf7ae489a76ca8794bfb952a30d08a229e6de4d60589032149e2cf43' },
    { role: 'targeted-checker', path: 'packages/dogfood/v04-heavy-negative-probe-check.mjs', sha256: '1946b21239e3627bbc1f7ee81fca6fac169908fa304a7f76c3f9667d641dd9fe' },
    { role: 'targeted-contract-tests', path: 'packages/dogfood/v04-heavy-negative-probe-check.test.mjs', sha256: '0fe7037d5abd3f58117142301703ba58620a95d4ab25ee8e7957b1447f85537b' },
  ].map(Object.freeze)),
});
