"use client"
import { Calendar } from "@/components/ui/calendar"
import React from "react"

export default function Test() {
    const [date, setDate] = React.useState<Date | undefined>(new Date())
    return (
        <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            className="rounded-lg border"
        />
    )
}
