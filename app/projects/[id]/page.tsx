import { notFound } from 'next/navigation'
import { getProject, getCreatorProfile } from './actions'
import ProjectDetails from './ProjectDetails'

type Props = {
  params: Promise<{ id: string }>
}

export default async function ProjectPage(params: Props): Promise<React.ReactElement> {
  const { id } = await params.params
  const { project, error: projectError } = await getProject(id)
  
  if (projectError || !project) {
    notFound()
  }

  const { profile: creator } = await getCreatorProfile(project.creator_id)
  
  return <ProjectDetails project={project} creator={creator} />
}