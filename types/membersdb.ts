export interface Member {
  name: string;
  phone: string;
  current_job: {
    role: string;
    company: string;
  };
  social: {
    github: string;
    linkedin?: string;
  };
  referer_name?: string;
}

export interface MembersYaml {
  members: Member[];
}