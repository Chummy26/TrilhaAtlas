import Lake
open Lake DSL

package trilha_atlas where
  leanOptions := #[
    ⟨`autoImplicit, false⟩
  ]

@[default_target]
lean_lib TrilhaAtlas where
  roots := #[`TrilhaAtlas.Kst, `TrilhaAtlas.Curriculum, `TrilhaAtlas.XpInvariants, `TrilhaAtlas.LessonExam]

lean_exe «lh-check» where
  root := `TrilhaAtlas.Check
