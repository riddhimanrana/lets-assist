#!/bin/bash
 
if [[ $VERCEL_ENV == "production"  ]] ; then 
  bun run build:production
else 
  bun run build:preview
fi