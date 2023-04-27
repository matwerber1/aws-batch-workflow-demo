#!/bin/bash

echo "Docker CMD parameters: $@"
echo "Container Environment Variables:"
echo "--------------------------------"
printenv | sort
echo "Running command: node index.js $@"
echo "---------------------------------"
node index.js "$@"